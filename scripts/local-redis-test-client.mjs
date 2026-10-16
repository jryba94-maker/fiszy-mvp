import { createConnection } from "node:net";
const port = process.env.QUEUE_TEST_REDIS_PORT;
if (!/^\d+$/.test(port ?? "")) throw new Error("An isolated local Redis port is required.");
function decode(buffer, offset = 0) {
  const end = buffer.indexOf("\r\n", offset);
  if (end < 0) return null;
  const type = String.fromCharCode(buffer[offset]);
  const value = buffer.toString("utf8", offset + 1, end);
  let next = end + 2;
  if (type === "+") return [value, next];
  if (type === "-") throw new Error(value);
  if (type === ":") return [Number(value), next];
  const count = Number(value);
  if (count === -1) return [null, next];
  if (type === "$") return buffer.length < next + count + 2 ? null : [buffer.toString("utf8", next, next + count), next + count + 2];
  if (type !== "*") throw new Error("Invalid Redis response");
  const values = [];
  for (let i = 0; i < count; i++) {
    const item = decode(buffer, next);
    if (!item) return null;
    values.push(item[0]); next = item[1];
  }
  return [values, next];
}
export const redis = (args) => new Promise((resolve, reject) => {
  const socket = createConnection({ host: "127.0.0.1", port: Number(port) });
  let data = Buffer.alloc(0);
  socket.setTimeout(5000, () => socket.destroy(new Error("Redis test timeout")));
  socket.on("error", reject);
  socket.on("connect", () => socket.write(`*${args.length}\r\n` + args.map(arg => `$${Buffer.byteLength(String(arg))}\r\n${arg}\r\n`).join("")));
  socket.on("data", chunk => {
    data = Buffer.concat([data, chunk]);
    try { const result = decode(data); if (result) { socket.end(); resolve(result[0]); } }
    catch (error) { socket.destroy(); reject(error); }
  });
});
