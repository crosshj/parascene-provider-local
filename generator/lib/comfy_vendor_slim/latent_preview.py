# Stub: common_ksampler uses prepare_callback(model, steps).


def prepare_callback(model, steps, x0_output_dict=None):
    def callback(step, x0, x, total_steps):
        if x0_output_dict is not None:
            x0_output_dict["x0"] = x0

    return callback
