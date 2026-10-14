if (process.versions.node !== '24.21.0' || !process.env.npm_config_user_agent?.startsWith('npm/11.19.0 ')) {
  console.error('MealPlan requires Node 24.21.0 / npm 11.19.0. See README.md.');
  process.exit(1);
}
