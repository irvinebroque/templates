import { defineConfig } from "vite-plus";

export default defineConfig({
	fmt: {
		useTabs: true,
		sortPackageJson: false,
		ignorePatterns: [
			"worker-configuration.d.ts",
			"env.d.ts",
			".react-router/**",
			".astro/**",
			".open-next/**",
			"build/**",
			"dist/**",
			"package-lock.json",
		],
	},
	lint: {
		ignorePatterns: [
			"worker-configuration.d.ts",
			"env.d.ts",
			".react-router/**",
			".astro/**",
			".open-next/**",
			"build/**",
			"dist/**",
		],
	},
});
