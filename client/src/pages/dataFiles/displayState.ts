export function shouldShowProjectFileError(
  status: string | null | undefined,
  errorMessage: string | null | undefined,
) {
  return status === "failed" && Boolean(errorMessage?.trim());
}
