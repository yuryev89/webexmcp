# Message attachments

Extend `webex_create_message` rather than introduce another sending tool. Accept
`files` (nonempty array of public HTTP(S) URLs), or `filePath` (absolute path to
one regular file on the MCP server). These modes are mutually exclusive. Text
and markdown remain optional when a file is present. Rooms, DMs and thread
replies keep their existing recipient fields and normalized response.

Use the existing Webex SDK: URL strings use JSON; a local file ReadStream uses
multipart. Open streams inside each auth retry and destroy them afterwards.
Reject missing/nonregular local files and files larger than 100 MB before sending.
No new dependencies, credentials, downloads, or real messages during tests.

Alternatives: URL-only forwarding is smaller but cannot send generated local
artifacts. A separate upload tool duplicates recipient and content options.
The selected extension reuses the existing message contract and SDK transport.

References: https://developer.webex.com/docs/rest-api-basics and installed
`@webex/plugin-messages/src/messages.js`.
