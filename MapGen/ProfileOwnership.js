var MapGen = MapGen || {};

MapGen.ProfileOwnership = {
    TargetPackOwnedKeys: function() {
        return {
            GeneratorCore: true,
            TargetPackProfile: true,
            TargetPack: true,
            TerrainVariant: true
        };
    },

    CompatAliasKeys: function() {
        return {
            Name: true,
            RequestedName: true,
            UnsupportedProfileReason: true
        };
    },

    ClassifyKey: function(pKey) {
        if(this.TargetPackOwnedKeys()[pKey])
            return "target_pack_owned";
        if(this.CompatAliasKeys()[pKey])
            return "compat_alias";
        return "runtime_shared";
    },

    AddUnique: function(pList, pValue) {
        for(var index = 0; index < pList.length; ++index) {
            if(pList[index] === pValue)
                return;
        }
        pList.push(pValue);
    },

    Apply: function(pProfile, pRaw, pRequestedName, pResolvedName) {
        var ownership = {
            target_pack_owned: [],
            runtime_shared: [],
            compat_alias: []
        };
        var classified = {};
        var key;

        for(key in (pRaw || {})) {
            if(!(pRaw || {}).hasOwnProperty(key))
                continue;
            var bucket = this.ClassifyKey(key);
            this.AddUnique(ownership[bucket], key);
            classified[key] = bucket;
        }

        this.AddUnique(ownership.compat_alias, "Name");
        this.AddUnique(ownership.compat_alias, "RequestedName");
        if(pProfile && pProfile.UnsupportedProfileReason)
            this.AddUnique(ownership.compat_alias, "UnsupportedProfileReason");

        pProfile.ProfileKnobOwnership = {
            schema: 1,
            policy: "target_pack_owned | runtime_shared | compat_alias",
            requestedName: pRequestedName || "",
            resolvedName: pResolvedName || "",
            buckets: ownership,
            classified: classified
        };

        return pProfile;
    }
};
