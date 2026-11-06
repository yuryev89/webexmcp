import type { normalizeMessage } from "./normalize.js";

export type MessageOutputMode = "full" | "compact";
type Message = ReturnType<typeof normalizeMessage> & {
  attachments?: Array<Record<string, unknown> | undefined>;
};

/**
 * Compact output keeps routing, source and thread identifiers but removes
 * duplicate rich text and long attachment URLs. Text truncation is explicit.
 */
export function presentMessage(message: Message, mode: MessageOutputMode, maxTextChars = 1200) {
  if (mode === "full") return message;

  const text = message.text ?? message.markdown ?? "";
  const shortened = text.length > maxTextChars;
  return {
    id: message.id,
    roomId: message.roomId,
    personEmail: message.personEmail,
    created: message.created,
    ...(message.parentId ? { parentId: message.parentId } : {}),
    text: shortened ? text.slice(0, maxTextChars) : text,
    ...(shortened ? { textTruncated: true, originalChars: text.length } : {}),
    ...(message.files?.length ? { fileCount: message.files.length } : {}),
    ...(message.attachments?.length ? {
      attachments: message.attachments.map((a) => a ? {
        filename: a.filename,
        contentType: a.contentType,
        size: a.size,
        kind: a.kind,
        ...(a.error ? { error: a.error } : {}),
      } : null),
    } : {}),
  };
}

export function presentMessages<T extends { messages: Message[] }>(
  result: T, mode: MessageOutputMode, maxTextChars = 1200
) {
  if (mode === "full") return result;
  return {
    ...result,
    messages: result.messages.map((message) => presentMessage(message, mode, maxTextChars)),
  };
}
