-- Where git truth lives (0046) named this site's side "codesplitters"; the site is
-- codesplitter now (#805). The API still takes the old name and stores the new one.
UPDATE users SET git_truth = 'codesplitter' WHERE git_truth = 'codesplitters';
