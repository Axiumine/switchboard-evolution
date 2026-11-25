// lsp/framing.js — the Language Server Protocol's framing on stdio: each
// message is "Content-Length: <bytes>\r\n\r\n" followed by that many bytes of
// UTF-8 JSON (other headers, such as Content-Type, are allowed and ignored).

const HEADER_END = Buffer.from('\r\n\r\n');
const MAX_MESSAGE = 64 * 1024 * 1024;

/** A message (a JSON string or an object) as the bytes to write to a server. */
function encodeMessage(message) {
  const body = Buffer.from(typeof message === 'string' ? message : JSON.stringify(message), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]);
}

/**
 * Reads a server's output: push() takes each chunk as it comes and returns
 * the whole messages it completes, as JSON strings. A header without a
 * Content-Length, or a message larger than MAX_MESSAGE, throws: the stream
 * cannot be trusted after that.
 */
class MessageReader {
  constructor() {
    this.buffer = Buffer.alloc(0);
    this.expected = -1; // the body length once the header is read
  }

  push(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : Buffer.from(chunk);
    const messages = [];
    for (;;) {
      if (this.expected < 0) {
        const end = this.buffer.indexOf(HEADER_END);
        if (end < 0) {
          if (this.buffer.length > 8192) throw new Error('Language server output without a message header');
          break;
        }
        const header = this.buffer.slice(0, end).toString('ascii');
        const match = /(?:^|\r\n)Content-Length:\s*(\d+)/i.exec(header);
        if (!match) throw new Error(`Language server message without a Content-Length: ${header.slice(0, 80)}`);
        this.expected = Number(match[1]);
        if (this.expected > MAX_MESSAGE) throw new Error(`Language server message too large (${this.expected} bytes)`);
        this.buffer = this.buffer.slice(end + HEADER_END.length);
      }
      if (this.buffer.length < this.expected) break;
      messages.push(this.buffer.slice(0, this.expected).toString('utf8'));
      this.buffer = this.buffer.slice(this.expected);
      this.expected = -1;
    }
    return messages;
  }
}

module.exports = { encodeMessage, MessageReader, MAX_MESSAGE };
