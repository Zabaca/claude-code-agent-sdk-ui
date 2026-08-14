import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { ClaudeHeader, ClaudeLogo } from "./claude-header.tsx";

describe("ClaudeHeader", () => {
  test("renders the welcome box from literal props", () => {
    render(
      <ClaudeHeader
        version="v2.1.206"
        user="James"
        model="Opus 5 · Claude Max"
        org="zabaca"
        cwd="~/dev/claude-code-agent-sdk-ui"
        tips={["Ask Claude to clone a repo"]}
        whatsNew={["Added /doctor"]}
      />,
    );

    expect(screen.getByText("Welcome back James!")).toBeDefined();
    expect(screen.getByText("Opus 5 · Claude Max")).toBeDefined();
    expect(screen.getByText("zabaca")).toBeDefined();
    expect(screen.getByText("~/dev/claude-code-agent-sdk-ui")).toBeDefined();
    expect(screen.getByText("Ask Claude to clone a repo")).toBeDefined();
    expect(screen.getByText("Added /doctor")).toBeDefined();
  });

  test("renders the version in the legend", () => {
    const { container } = render(<ClaudeHeader version="v9.9.9" />);
    expect(container.querySelector("legend")?.textContent).toContain("v9.9.9");
  });

  test("renders with no tips and nothing new", () => {
    render(<ClaudeHeader tips={[]} whatsNew={[]} />);
    expect(screen.getByText("Tips for getting started")).toBeDefined();
  });
});

describe("ClaudeLogo", () => {
  test("draws the sprite at the requested scale", () => {
    const { container } = render(<ClaudeLogo scale={2} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("36");
    expect(svg?.querySelectorAll("rect").length).toBeGreaterThan(0);
  });
});
