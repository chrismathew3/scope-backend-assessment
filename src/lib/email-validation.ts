/**
 * Check if an email is allowed to sign up
 * Only daniel.bogart17@gmail.com and @scopelabs.com emails are allowed
 */
export function isAllowedEmail(email: string): boolean {
  if (email === "daniel.bogart17@gmail.com") {
    return true;
  }
  if (email.endsWith("@scopelabs.com")) {
    return true;
  }
  return false;
}
