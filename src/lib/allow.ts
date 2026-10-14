/** ORBIT_ALLOWED_EMAILS: comma-separated emails allowed to use ORBIT (empty = any signed-in user). */
export function isAllowedEmail(email: string | undefined): boolean {
  const list = (process.env.ORBIT_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.length === 0 || (!!email && list.includes(email.toLowerCase()));
}
