import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { ClaudeTodoList } from "./claude-todo-list.tsx";

describe("ClaudeTodoList", () => {
  test("renders the plan from literal props", () => {
    render(
      <ClaudeTodoList
        todos={[
          { label: "Vendor the components", status: "done" },
          { label: "Build the stylesheet", status: "active" },
          { label: "Wire the container", status: "todo" },
        ]}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText(/Vendor the components/)).toBeDefined();
  });

  test("states every item's progress in words, not only glyphs", () => {
    const { container } = render(
      <ClaudeTodoList
        todos={[
          { label: "one", status: "done" },
          { label: "two", status: "active" },
          { label: "three", status: "todo" },
        ]}
      />,
    );

    expect(container.textContent).toContain("completed");
    expect(container.textContent).toContain("in progress");
    expect(container.textContent).toContain("pending");
  });

  test("renders an empty plan without falling over", () => {
    render(<ClaudeTodoList todos={[]} />);
    expect(screen.queryAllByRole("listitem")).toEqual([]);
  });
});
