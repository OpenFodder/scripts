var MapGen = MapGen || {};
MapGen.Integration = MapGen.Integration || {};

(function(pIntegration) {
    // A retry owns the complete map and sprite state. No attempt saves files.
    pIntegration.CompleteAttempt = function(context) {
        context.InAttempt = true;
        context.AttemptStage = "placement";
        context.PlanValidation = {
            ok: context.Validation.ok,
            reasons: context.Validation.reasons.slice(0),
            warnings: context.Validation.warnings.slice(0)
        };
        try {
            Session.Reset();
            this.ApplyContextToSettings(context);
            this.StoreContext(context);
            Map.seed = context.Seed;
            MapGen.Render.CreateMap(context, context.Map);
            if(MapGen.Context.IsMultiplayer(context)) {
                Multiplayer.CreateMatch();
                if(this.PolishFinalIceMap) this.PolishFinalIceMap(context);
                context.AttemptStage = "runtime_validation";
                Validation.ValidateMap();
                context.AttemptStage = "live_validation";
                var live = this.ValidateMaterializedMultiplayer();
                if(!live.ok) throw new Error(live.reasons.join(", "));
            } else {
                this.MaterializeCampaign(context);
            }
            if(!context.FastTileIteration && context.IntentMap) {
                context.AttemptStage = "drift_validation";
                var drift = MapGen.Context.Time(context, "Live.ValidateDrift", function() {
                    return MapGen.Intent.Drift.ValidateCommitted(context);
                });
                if(!drift.ok) throw new Error(drift.reasons.join(", "));
            }
            context.AttemptStage = "final_metrics";
            context.Validation.metrics = MapGen.Context.Time(context, "Live.FinalMetrics", function() {
                return MapGen.Metrics.Compute(context);
            });
            context.Materialized = true;
            context.AttemptStage = "accepted";
        } catch(error) {
            var reason = context.AttemptStage + ":" + error;
            context.Validation.ok = false;
            context.Validation.reasons.push(reason);
            if(!context.LiveValidation || context.LiveValidation.ok) {
                context.LiveValidation = { ok: false, mode: context.GameMode.kind,
                    reasons: [reason], counts: {} };
            }
            MapGen.Context.AddLog(context, "Rejected final attempt: " + reason);
        } finally {
            context.RuntimeValidation = Session.RuntimeValidation || null;
            context.InAttempt = false;
            context._deferStructureRender = false;
        }
    };

    pIntegration.GenerateMaterializedMap = function(options, multiplayer) {
        var self = this;
        options.RenderInvalid = false;
        options.CompleteAttempt = function(context) { self.CompleteAttempt(context); };
        var context = multiplayer ? MapGen.GenerateMultiplayer(options) : MapGen.GenerateCampaign(options);
        this.StoreContext(context);
        this.PrintValidation(context);
        this.WriteContextMetadata(context, options.Seed);
        if(!context || !context.Materialized || !context.Validation.ok) {
            var reasons = context && context.Validation ? context.Validation.reasons : ["no_context"];
            if(!multiplayer) Scenario.Random.RecordFailure(reasons.join(", "));
            var requestedSeed = context && context.RequestedSeed !== undefined ? context.RequestedSeed : options.Seed;
            var profileName = context && context.Profile ? context.Profile.Name :
                (options.Profile && options.Profile.Name ? options.Profile.Name : options.ProfileName || "");
            var dimensions = context && context.Width !== undefined && context.Height !== undefined ?
                context.Width + "x" + context.Height : "unknown";
            throw new Error("MapGen exhausted attempts (requested seed " + requestedSeed +
                ", profile " + profileName + ", dimensions " + dimensions + "): " + reasons.join(", "));
        }
        return context;
    };

    pIntegration.GenerateCampaignMap = function() {
        return this.GenerateMaterializedMap(this.CampaignOptions(), false);
    };

    pIntegration.GenerateMultiplayerMap = function() {
        return this.GenerateMaterializedMap(this.MultiplayerOptions(), true);
    };
})(MapGen.Integration);
