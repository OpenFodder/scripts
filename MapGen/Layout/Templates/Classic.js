(function() {

    var template = {
        Name: "classic",

        BuildAnchorsCampaign: function(pContext) {
            MapGen.Layout.Anchors.BuildCampaign(pContext);
        },

        BuildAnchorsMultiplayer: function(pContext) {
            MapGen.Layout.Anchors.BuildMultiplayer(pContext);
        }
    };

    MapGen.Layout.Templates.Register(template);
})();
