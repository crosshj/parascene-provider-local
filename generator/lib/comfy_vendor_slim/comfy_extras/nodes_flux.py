# Hot path: CLIPTextEncodeFlux.execute(clip, clip_l, t5xxl, guidance).
# Real implementation; clip comes from comfy.sd.load_clip (full vendor).


class CLIPTextEncodeFlux:
    @classmethod
    def execute(cls, clip, clip_l, t5xxl, guidance):
        tokens = clip.tokenize(clip_l)
        tokens["t5xxl"] = clip.tokenize(t5xxl)["t5xxl"]
        result = clip.encode_from_tokens_scheduled(tokens, add_dict={"guidance": guidance})
        return (result,)

    encode = execute
