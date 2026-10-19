LEGACY_EMBEDDING_MODEL_ID = "buffalo_l@insightface-0.7.3"


def make_embedding_model_id(model_name, insightface_version):
    return f"{model_name}@insightface-{insightface_version}"


def is_embedding_compatible(student, active_model_id):
    # All previously stored embeddings came from the original hard-coded
    # buffalo_l loader. Treat only that exact legacy implementation as known.
    stored_model_id = student.get("embeddingModel") or LEGACY_EMBEDDING_MODEL_ID
    return stored_model_id == active_model_id
