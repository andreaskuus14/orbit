/** ORBIT_ALLOWED_EMAILS: comma-separated emails allowed to use ORBIT (empty = any signed-in user, except on the cloud server:
 *  with ORBIT_ROLE=cloud an empty list lets nobody in, because that server is on the open internet). */
export function isAllowedEmail(email: string | undefined): boolean {
  const list = (process.env.ORBIT_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) return (process.env.ORBIT_ROLE ?? "").trim().toLowerCase() !== "cloud";
  return (!!email && list.includes(email.toLowerCase()));
}
