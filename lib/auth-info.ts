import { enabledProviders } from "./oauth";
import { accountCount, getSignupPolicy } from "./accounts";

export async function authInfo() {
  const first = (await accountCount()) === 0;
  const p = await getSignupPolicy();
  return {
    providers: enabledProviders(),
    firstRun: first,
    needsCode: first && !!process.env.SETUP_CODE,
    signup: first ? "open" : p.mode,
    domains: p.mode === "domains" ? p.domains : [],
  };
}
