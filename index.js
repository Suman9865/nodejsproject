const express = require("express");
const app = express();
const path = require("path");
const { authenticate } = require("@google-cloud/local-auth");
const { google } = require("googleapis");
const dotenv = require("dotenv");
dotenv.config();

// Define the scopes needed for Gmail API access
const NEEDS = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.labels",
  "https://mail.google.com/",
];

// Define the label name for vacation auto-reply
const labelName = "Vacation Auto-Reply";

app.get("/", async (req, res) => {
  try {
    // Authenticate with Google GMAIL
    const auth = await authenticate({
      keyfilePath: path.join(__dirname, "credentials.json"),
      scopes: NEEDS,
    });

    // Get authorized Gmail API instance
    const mail = google.gmail({ version: "v1", auth });

    // Get the list of labels available on the current Gmail account
    const labelLists = await mail.users.labels.list({
      userId: "me",
    });

     // Function to generate the label ID or retrieve it if it already exists
     async function createLabel() {
      try {
        const resp = await mail.users.labels.create({
          userId: "me",
          requestBody: {
            name: labelName,
            labelListVisibility: "labelShow",
            messageListVisibility: "show",
          },
        });
        return resp.data.id;
      } catch (error) {
        if (error.code === 409) {
          const labelLists = await mail.users.labels.list({
            userId: "me",
          });
          const currentLabel = labelLists.data.labels.find(
            (label) => label.name === labelName
          );
          return currentLabel.id;
        } else {
          throw error;
        }
      }
    }

    // Function to find all unreplied or unseen emails in the inbox
    async function getUnrepliedMails() {
      const response = await mail.users.messages.list({
        userId: "me",
        labelIds: ["INBOX"],
        q: "is:unread",
      });

      return response.data.messages || [];
    }

    // Function to handle the main email processing logic
    async function executeEmails() {
      // Create or retrieve the label ID for the app
      const labelId = await createLabel();

      // Repeat at random intervals
      setInterval(async () => {
        // Get messages that have no prior reply
        const messages = await getUnrepliedMails();

        // Check if there are emails that did not receive a reply
        if (messages && messages.length > 0) {
          for (const message of messages) {
            const emailData = await mail.users.messages.get({
              auth,
              userId: "me",
              id: message.id,
            });

            const email = emailData.data;
            const hasReplied = email.payload.headers.some(
              (header) => header.name === "In-Reply-To"
            );

            if (!hasReplied) {
              // Craft the reply message
              const sendMessage = {
                userId: "me",
                resource: {
                  raw: Buffer.from(
                    `To: ${
                      email.payload.headers.find(
                        (header) => header.name === "From"
                      ).value
                    }\r\n` +
                      `Subject: Re: ${
                        email.payload.headers.find(
                          (header) => header.name === "Subject"
                        ).value
                      }\r\n` +
                      `Content-Type: text/plain; charset="UTF-8"\r\n` +
                      `Content-Transfer-Encoding: 7bit\r\n\r\n` +
                      `Thank you for your email. I'm currently on vacation and will respond to your message when I return.\r\n`
                  ).toString("base64"),
                },
              };

              // Send the auto-reply
              await mail.users.messages.send(sendMessage);

              // Add label and move the email
              await mail.users.messages.modify({
                auth,
                userId: "me",
                id: message.id,
                resource: {
                  addLabelIds: [labelId],
                  removeLabelIds: ["INBOX"],
                },
              });
            }
          }
        }
      }, Math.floor(Math.random() * (120 - 45 + 1) + 45) * 1000);
    }

    // Start the email processing
    executeEmails();

    // Respond with authentication status
    res.json({ "Authentication Status": "Successful" });
  } catch (error) {
    console.error("Error during setup:", error);
    res.status(500).json({ "Error": "Internal Server Error" });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
