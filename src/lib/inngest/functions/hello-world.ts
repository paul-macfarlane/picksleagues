import { inngest } from "../client";

export const helloWorld = inngest.createFunction(
  { id: "hello-world" },
  { event: "test/hello.world" },
  async ({ event, step }) => {
    await step.run("greet", () => {
      return `Hello, ${event.data.name ?? "world"}!`;
    });

    return { message: "Hello world function completed" };
  },
);
