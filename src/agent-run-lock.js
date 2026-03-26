/**
 * Limits concurrent heavy agent runs (Niche / single-website) to protect CPU on small instances.
 * General-chat bypasses this lock in the router.
 */
const maxConcurrent = (() => {
  const n = Number.parseInt(process.env.AGENT_MAX_CONCURRENT_RUNS || '1', 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
})();

let running = 0;
const waiters = [];

function acquire() {
  return new Promise((resolve) => {
    if (running < maxConcurrent) {
      running += 1;
      resolve();
    } else {
      waiters.push(() => resolve());
    }
  });
}

function release() {
  if (waiters.length > 0) {
    const wake = waiters.shift();
    wake();
  } else {
    running -= 1;
  }
}

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withAgentRunLock(fn) {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}
