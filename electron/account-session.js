// Invalidate identity before async account changes. Old completions cannot
// restore an account, and stale UI requests cannot act on a different user.
function createAccountSession(onClear = () => {}) {
  let account = null;
  let revision = 0;
  return {
    revision: () => revision,
    clear() { account = null; ++revision; onClear(); return revision; },
    verify(expectedRevision, profile) {
      if (revision !== expectedRevision) throw new Error('Spotify account changed. Try again.');
      if (typeof profile?.account_id !== 'string' || !profile.account_id.trim()) {
        throw new Error('Spotify did not provide an account identity. Reconnect and try again.');
      }
      const photo = (Array.isArray(profile.images) ? profile.images : []).find(image => {
        try { return new URL(image?.url).protocol === 'https:'; } catch { return false; }
      });
      account = { id: profile.account_id, name: profile.display_name || profile.id || 'Spotify account', imageUrl: photo?.url || null };
      return account;
    },
    require(expectedId) {
      if (!account || account.id !== expectedId) throw new Error('Connect the correct Spotify account before accessing trims.');
      return account.id;
    },
  };
}
module.exports = { createAccountSession };
