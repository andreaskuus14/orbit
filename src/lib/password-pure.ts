/** Sign-in password rules for ORBIT (Supabase enforces its own minimum too). Returns a message, or "" when OK. */
export const PASSWORD_MIN = 10;
export function passwordProblem(pw: string, confirm: string): string {
  if (pw.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (pw.length > 72) return "Use at most 72 characters."; // bcrypt ignores anything after 72 bytes
  if (!/\S/.test(pw)) return "The password can't be only spaces.";
  if (pw !== confirm) return "The two passwords don't match.";
  return "";
}
