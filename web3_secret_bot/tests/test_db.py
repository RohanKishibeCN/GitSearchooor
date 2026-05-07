import tempfile
import unittest

from web3_secret_bot.db import Hit, StateDB, make_dedup_key


class TestDB(unittest.TestCase):
    def test_dedup(self):
        with tempfile.TemporaryDirectory() as d:
            path = f"{d}/state.db"
            db = StateDB(path)
            db.init()

            dk = make_dedup_key("a/b", "x.txt", "sha", "term")
            h = Hit(
                dedup_key=dk,
                repo="a/b",
                repo_url="https://github.com/a/b",
                file_path="x.txt",
                file_url="https://github.com/a/b/blob/main/x.txt",
                blob_sha="sha",
                term="term",
                ecosystem="unknown",
                snippet_masked="x",
                scanned_at=1,
            )
            self.assertTrue(db.insert_hit_if_new(h))
            self.assertFalse(db.insert_hit_if_new(h))
            db.close()


if __name__ == "__main__":
    unittest.main()
