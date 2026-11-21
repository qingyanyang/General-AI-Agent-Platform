/**
 * Auth0 post-login Action.
 *
 * 1. Deny the login when the email is missing or not verified.
 * 2. Copy the verified email onto the API access token so this app can store
 *    it and reject an unverified token even if the login page is skipped.
 *
 * Set the Action secret CLAIM_NAMESPACE to the API audience, for example
 * https://api.agent-platform
 * Then set AUTH0_REQUIRE_VERIFIED_EMAIL=true on the API.
 */
exports.onExecutePostLogin = async (event, api) => {
  if (event.user.email_verified !== true || !event.user.email) {
    api.access.deny('Verify your email before continuing.')
    return
  }
  const namespace = event.secrets.CLAIM_NAMESPACE
  if (!namespace) {
    return
  }
  api.accessToken.setCustomClaim(`${namespace}/email`, event.user.email)
  api.accessToken.setCustomClaim(`${namespace}/email_verified`, true)
  if (event.user.name) {
    api.accessToken.setCustomClaim(`${namespace}/name`, event.user.name)
  }
}
