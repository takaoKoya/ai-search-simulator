import { config } from "dotenv";
import { checkEnv, formatReport, hasErrors } from "../lib/env-check";

// Same precedence as Next.js: real env > .env.local > .env (dotenv never overrides).
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const results = checkEnv(process.env);
console.log(formatReport(results));
process.exit(hasErrors(results) ? 1 : 0);
