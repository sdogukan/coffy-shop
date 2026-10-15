import { hashAdminPassword } from "../admin/password.ts";
import { runCli } from "./run.ts";

// Usage: npm run --silent admin:hash-password
// Prints the COFFY_ADMIN_PASSWORD_HASH value for a staff password. The
// password is read from standard input only: typed without echo (and asked
// twice) on a terminal, or piped. It is never taken from the command line,
// where it would show up in the process list and shell history, and it is
// never printed. Only the hash goes to stdout.

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    let value = "";
    const finish = (error?: Error) => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      process.stderr.write("\n");
      if (error === undefined) {
        resolve(value);
      } else {
        reject(error);
      }
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n" || char === "\u0004") {
          finish();
          return;
        }
        if (char === "\u0003") {
          finish(new Error("Cancelled"));
          return;
        }
        value = char === "\u007f" || char === "\b" ? [...value].slice(0, -1).join("") : value + char;
      }
    };
    process.stderr.write(prompt);
    input.setEncoding("utf8");
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

async function readPiped(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  // One trailing line break is the end of the line, not part of the password.
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    return readPiped();
  }
  const password = await readHidden("Password: ");
  // Nothing is echoed, so a typo would otherwise go unnoticed.
  if ((await readHidden("Repeat password: ")) !== password) {
    throw new Error("The passwords do not match");
  }
  return password;
}

await runCli("admin:hash-password", async () => {
  if (process.argv.length > 2) {
    throw new Error("The password is read from standard input; command-line arguments are not accepted");
  }
  console.log(await hashAdminPassword(await readPassword()));
});
