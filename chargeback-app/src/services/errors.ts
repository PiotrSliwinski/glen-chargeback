import type { ActionErrorCode } from "@/lib/action-result";

/** Business-rule violation raised by services, mapped to ActionResult by actions. */
export class DomainError extends Error {
  constructor(
    public code: ActionErrorCode,
    message: string,
  ) {
    super(message);
  }
}
