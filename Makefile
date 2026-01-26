build:
	npm run build
	npm run test

watch:
	npm run build; git-stats html out.jsonl;
	open .git-stats/report.html
	while true; do clear; npm run build; git-stats html out.jsonl; sleep 10; done
