import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WORKFLOWS_DIR = new URL("../../.github/workflows/", import.meta.url);

function readWorkflow(name: string): string {
  return readFileSync(fileURLToPath(new URL(name, WORKFLOWS_DIR)), "utf8");
}

// The jobs must stop at the first failing gate, in this order.
function expectGatesInOrder(workflow: string): void {
  const positions = ["run: npm ci", "run: npm run typecheck", "run: npm test", "run: npm run build"].map((step) =>
    workflow.indexOf(step),
  );
  expect(positions.every((position) => position >= 0)).toBe(true);
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
}

// Text checks on the parts the deploy's safety depends on; the workflows
// themselves only run on GitHub.
describe("pull request workflow", () => {
  const workflow = readWorkflow("pr.yml");

  it("runs npm ci, typecheck, test and build on the .nvmrc Node version", () => {
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("node-version-file: .nvmrc");
    expectGatesInOrder(workflow);
  });

  it("runs the local smoke against the build it just made, after the build gate", () => {
    const steps = ["run: npm run build", "run: npx playwright install --with-deps chromium", "run: npm run smoke:run"].map(
      (step) => workflow.indexOf(step),
    );
    expect(steps.every((position) => position >= 0)).toBe(true);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
    // npm run smoke builds again; the PR job stays inside its time limit with one build.
    expect(workflow).not.toMatch(/run: npm run smoke$/m);
  });

  it("never touches the Demo environment or its settings", () => {
    expect(workflow).not.toMatch(/environment|secrets\.|vars\./);
  });

  it("never masks a failing step", () => {
    expect(workflow).not.toContain("continue-on-error");
  });
});

describe("main workflow", () => {
  const workflow = readWorkflow("main.yml");
  const [build = "", deploy = ""] = workflow.split("\n  deploy:\n");

  it("builds and packages on push to main", () => {
    expect(workflow).toMatch(/on:\n {2}push:\n {4}branches: \[main\]\n/);
    expect(build).toContain("node-version-file: .nvmrc");
    expectGatesInOrder(build);
    expect(build.indexOf("npm run package:release")).toBeGreaterThan(build.indexOf("run: npm run build"));
    expect(build).toContain("if-no-files-found: error");
  });

  it("deploys in the Demo environment, serialised and time-limited", () => {
    expect(deploy).toContain("needs: build");
    expect(deploy).toContain("environment:\n      name: Demo\n      url: ${{ vars.COFFY_APP_URL }}\n");
    expect(deploy).toMatch(/concurrency:\n {6}group: \S+\n {6}cancel-in-progress: false\n/);
    expect(deploy).toMatch(/\n {4}timeout-minutes: \d+\n/);
  });

  it("checks the settings first, then uploads, activates, verifies and rolls back in one job", () => {
    const order = [
      "scripts/ci/check-deploy-config.sh",
      "scripts/ci/upload-release.sh",
      "coffy-shop-deploy activate $GITHUB_SHA",
      'scripts/ci/verify-release.sh "$COFFY_APP_URL" "$GITHUB_SHA"',
      "coffy-shop-deploy rollback $GITHUB_SHA",
    ].map((text) => deploy.indexOf(text));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("rolls back whenever activation was attempted and a later step failed", () => {
    expect(deploy).toMatch(/- name: Roll back release\n\s+if: >-\n\s+\(failure\(\) \|\| cancelled\(\)\) &&\n\s+contains\(.*steps\.activate\.outcome\)/);
  });

  it("always removes the SSH key and never scans the host key", () => {
    expect(deploy).toMatch(/- name: Remove SSH key\n\s+if: always\(\)\n\s+run: rm -rf -- "\$RUNNER_TEMP\/coffy-ssh"/);
    expect(deploy).toContain("StrictHostKeyChecking yes");
    expect(workflow).not.toContain("ssh-keyscan");
  });

  it("passes secrets only through env and never masks a failing step", () => {
    for (const line of workflow.split("\n").filter((text) => text.includes("secrets."))) {
      expect(line).toMatch(/^ {10}([A-Z_]+): \$\{\{ secrets\.\1 \}\}$/);
    }
    expect(workflow).not.toContain("continue-on-error");
  });
});
