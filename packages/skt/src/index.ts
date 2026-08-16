import { cli } from "./skt";
import { PromptCancelled } from "./ui/prompts";

try {
  await cli.run();
} catch (error) {
  if (error instanceof PromptCancelled) {
    process.exit(130);
  }
  throw error;
}
