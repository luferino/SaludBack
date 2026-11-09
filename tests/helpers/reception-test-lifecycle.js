export function observeStarted(promise) {
  return promise.then(
    (value) => ({ status: 'fulfilled', value }),
    (reason) => ({ status: 'rejected', reason }),
  );
}

export async function releaseAndSettleReceptionOperations(releases, operations) {
  for (const release of releases) release();
  return Promise.all(operations);
}

export async function cleanupReceptionTest(cleanups, primaryError) {
  const failures = [];
  for (const cleanup of cleanups) {
    try {
      await cleanup();
    } catch (error) {
      failures.push(error);
    }
  }

  if (primaryError && failures.length) {
    throw new AggregateError([primaryError, ...failures], 'Reception test and cleanup failed');
  }
  if (primaryError) throw primaryError;
  if (failures.length) throw new AggregateError(failures, 'Reception test cleanup failed');
}
