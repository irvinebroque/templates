import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import MarkdownError from "../src/MarkdownError";
import { lint } from "../src/lint";

const directories: string[] = [];
afterEach(() => {
	for (const directory of directories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function diagnostics(configuration?: string): string {
	const root = mkdtempSync(join(tmpdir(), "config-"));
	const directory = join(root, "example-template");
	// The linter discovers standalone templates by their directory suffix.
	mkdirSync(directory);
	directories.push(root);
	writeFileSync(
		join(directory, "package.json"),
		JSON.stringify({ name: "example-template" }),
	);
	if (configuration)
		writeFileSync(join(directory, configuration), "export default {};");
	try {
		lint({ templateDirectory: directory, fix: false });
		return "";
	} catch (error) {
		if (error instanceof MarkdownError) return error.markdown;
		throw error;
	}
}

describe("template configuration", () => {
	it("accepts typed cf configuration without requiring a Wrangler file", () => {
		expect(diagnostics("cloudflare.config.ts")).not.toContain(
			"Expected cloudflare.config.ts",
		);
	});
	it("still rejects templates with no configuration", () => {
		expect(diagnostics()).toContain("Expected cloudflare.config.ts");
	});
});
