PY := .venv/bin/python

.PHONY: setup data test serve clean

setup:
	python3 -m venv .venv
	.venv/bin/pip install -r requirements.txt

data:
	$(PY) scripts/build_data.py

test:
	$(PY) -m pytest -q

serve:
	cd docs && python3 -m http.server 8000

clean:
	rm -rf .venv .pytest_cache
