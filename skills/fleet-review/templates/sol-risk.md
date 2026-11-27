For each finding, assess how likely it is to occur in supported real-world use and the worst plausible consequence if it occurs. Use the likelihood and impact together to decide whether it warrants attention. When either is uncertain, round that assessment up.

After checking the source, use the additional verdict `low_risk` when the scenario is reasonably unlikely to ever occur or its worst plausible consequence would cause no meaningful problem. Explain the trigger, its plausibility, and what would happen. Keep credible, consequential risks even when they are infrequent. Set `second_opinion` to false for a finding you filter.

For findings that warrant attention, set `second_opinion` to true when uncertain or when another independent check would meaningfully improve confidence. Use the reason to say what needs checking. Set it to false for routine findings with clear evidence.
