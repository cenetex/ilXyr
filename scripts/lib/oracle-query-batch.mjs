// Results keep candidate order. Completion callbacks run before another dispatch.
// A failed callback stops new work; every in-flight query still reaches observe.
export async function executeObservedBatch({ workers, items, query, beforeDispatch, observe }) {
  if (!workers.length && items.length) throw new Error("query batch needs workers");
  const results = new Array(items.length);
  let next = 0;
  let inFlight = 0;
  let failure = null;
  await Promise.all(workers.map(async (worker, workerIndex) => {
    while (!failure && next < items.length) {
      try { beforeDispatch({ inFlight, next }); }
      catch (error) { failure ??= error; return; }
      const index = next++;
      inFlight += 1;
      const started = performance.now();
      let result;
      try { result = await query(worker, items[index], index, workerIndex); }
      catch (error) {
        result = { status: "query_exception", multiplicity: null,
          elapsed_ms: performance.now() - started, error: error.message };
      }
      inFlight -= 1;
      results[index] = result;
      try { await observe(result, items[index], index, worker); }
      catch (error) { failure ??= error; }
    }
  }));
  if (failure) throw failure;
  return results;
}
