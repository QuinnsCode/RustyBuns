-- The merge check's own switch (src/deps.ts tryInClone, #998): whether a conflict agent's
-- answer is tested in a throwaway clone, apart from the doctor's run_tests. It starts as
-- run_tests was, since that switch decided it until now.
ALTER TABLE dep_watches ADD COLUMN test_merges INTEGER NOT NULL DEFAULT 0;
UPDATE dep_watches SET test_merges = run_tests;
