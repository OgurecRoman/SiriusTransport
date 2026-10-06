from __future__ import annotations

import argparse

from parser import parse_file


def main() -> None:
	parser = argparse.ArgumentParser(description="Parse tram telemetry JSON stream")
	parser.add_argument("path", help="path to a concatenated JSON telemetry file")
	args = parser.parse_args()
	result = parse_file(args.path)
	print(f"readings={len(result.readings)} parse_errors={len(result.parse_errors)}")


if __name__ == "__main__":
	main()
