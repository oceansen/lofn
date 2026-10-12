import { json, route } from "@/lib/http";
import { accountCount } from "@/lib/accounts";

// Kept for compatibility: first-run state. Creating accounts goes through /api/admin/signup.
export const GET = route(async () => json({ needsSetup: (await accountCount()) === 0, needsCode: !!process.env.SETUP_CODE }));
export { POST } from "../signup/route";
