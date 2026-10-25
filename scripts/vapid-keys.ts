// npm run remote:vapid: prints a fresh VAPID key pair for phone notifications (docs/PHONE.md). Paste both lines into .env.local.
// A new pair invalidates existing subscriptions: tap Enable notifications on the phone again afterwards.
import { vapidKeys } from "../src/lib/remote-push-pure.ts";

const k = vapidKeys();
console.log(`REMOTE_VAPID_PUBLIC=${k.publicKey}\nREMOTE_VAPID_PRIVATE=${k.privateKey}`);
