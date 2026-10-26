import { defineConfig } from 'vitest/config';

// End-to-end suites: real OpenTodo (and n8n) containers, one file at a time.
export default defineConfig({
	test: {
		include: ['tests_e2e/**/*.e2e.test.mts'],
		environment: 'node',
		fileParallelism: false,
		sequence: { concurrent: false },
		testTimeout: 120_000,
		hookTimeout: 300_000,
	},
});
