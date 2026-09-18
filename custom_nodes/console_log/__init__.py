class ConsoleLog:
	@classmethod
	def INPUT_TYPES(cls):
		return {
			"required": {
				"text": ("STRING", {
					"default": "",
					"multiline": True,
				}),
			}
		}

	RETURN_TYPES = ()
	FUNCTION = "log"
	CATEGORY = "debug"
	OUTPUT_NODE = True

	def log(self, text):
		print(text)
		return ()


NODE_CLASS_MAPPINGS = {
	"ConsoleLog": ConsoleLog,
}

NODE_DISPLAY_NAME_MAPPINGS = {
	"ConsoleLog": "Console Log",
}