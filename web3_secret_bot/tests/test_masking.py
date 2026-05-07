import unittest

from web3_secret_bot.masking import desensitize


class TestMasking(unittest.TestCase):
    def test_hex_private_key_masked(self):
        s = "PRIVATE_KEY=0x" + "a" * 64
        out = desensitize(s)
        self.assertNotIn("0x" + "a" * 64, out)

    def test_mnemonic_masked(self):
        s = "abandon " * 11 + "about"
        out = desensitize(s)
        self.assertNotIn(s, out)
        self.assertIn("MNEMONIC_SHA256", out)


if __name__ == "__main__":
    unittest.main()
