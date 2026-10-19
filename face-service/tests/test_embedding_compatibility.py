import unittest

from services.embedding_compatibility import (
    LEGACY_EMBEDDING_MODEL_ID,
    is_embedding_compatible,
    make_embedding_model_id,
)


class EmbeddingCompatibilityTests(unittest.TestCase):
    buffalo_l = "buffalo_l@insightface-0.7.3"
    buffalo_sc = "buffalo_sc@insightface-0.7.3"

    def test_model_id_includes_model_pack_and_library_version(self):
        self.assertEqual(
            make_embedding_model_id("buffalo_sc", "0.7.3"),
            self.buffalo_sc,
        )

    def test_legacy_embeddings_are_only_compatible_with_original_model(self):
        legacy_student = {"embedding": [0.1, 0.2]}
        self.assertEqual(LEGACY_EMBEDDING_MODEL_ID, self.buffalo_l)
        self.assertTrue(is_embedding_compatible(legacy_student, self.buffalo_l))
        self.assertFalse(is_embedding_compatible(legacy_student, self.buffalo_sc))

    def test_explicitly_marked_embeddings_never_cross_model_boundaries(self):
        buffalo_l_student = {"embeddingModel": self.buffalo_l, "embedding": [0.1]}
        buffalo_sc_student = {"embeddingModel": self.buffalo_sc, "embedding": [0.1]}

        self.assertTrue(is_embedding_compatible(buffalo_l_student, self.buffalo_l))
        self.assertFalse(is_embedding_compatible(buffalo_l_student, self.buffalo_sc))
        self.assertTrue(is_embedding_compatible(buffalo_sc_student, self.buffalo_sc))
        self.assertFalse(is_embedding_compatible(buffalo_sc_student, self.buffalo_l))


if __name__ == "__main__":
    unittest.main()
