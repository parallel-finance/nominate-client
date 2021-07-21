module.exports = {
	apps: [
		{
			name: 'nominate-client',
			script: './node_modules/.bin/ts-node',
			args: 'src/main.ts',
			instances: 1,
			autorestart: true,
			watch: false,
			max_memory_restart: '1G'
		}
	]
}
