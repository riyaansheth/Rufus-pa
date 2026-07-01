/**
 * Convex ↔ Clerk auth binding.
 *
 * Convex verifies the JWT minted by Clerk's "convex" JWT template. Set the issuer
 * domain via the CLERK_JWT_ISSUER_DOMAIN environment variable on your Convex
 * deployment:  `npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your>.clerk.accounts.dev`
 *
 * The applicationID must be "convex" and match the Clerk JWT template name.
 */
const authConfig = {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};

export default authConfig;
