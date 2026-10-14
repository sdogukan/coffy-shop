// Entry points are run with plain `node` (Node 24 strips the types), so they
// import only Node built-ins and this repo's own modules.
export async function runCli(name: string, task: () => void | Promise<void>): Promise<void> {
  try {
    await task();
  } catch (error) {
    console.error(`${name} failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
