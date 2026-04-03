import {
  classifyError,
  createSetupRequiredResponse,
  formatClassifiedError,
  isSetupRequiredError,
} from "../../../../sdk.js";

export const handleError = (
  error: unknown,
  tool: string,
): { content: Array<{ type: "text"; text: string }>; isError?: true } => {
  const errorObj = error instanceof Error ? error : new Error(String(error));
  if (isSetupRequiredError(errorObj.message)) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            createSetupRequiredResponse({ attemptedAction: tool }),
            null,
            2,
          ),
        },
      ],
    };
  }
  const classified = classifyError(errorObj);
  const formatted = formatClassifiedError(classified);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ ...formatted, tool }, null, 2),
      },
    ],
    isError: true,
  };
};
