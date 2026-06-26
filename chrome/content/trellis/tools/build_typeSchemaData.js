var { FilePicker } = ChromeUtils.importESModule('chrome://trellis/content/modules/filePicker.mjs');

(async function () {
    // Create schema
    var schema = {"itemTypes":{}, "creatorTypes":{}, "fields":{}};
    var types = Trellis.ItemTypes.getTypes();

    var fieldIDs = await Trellis.DB.columnQueryAsync("SELECT fieldID FROM fieldsCombined");
    var baseMappedFields = Trellis.ItemFields.getBaseMappedFields();
    
    for (let fieldID of fieldIDs) {
        var fieldObj = [/* name */Trellis.ItemFields.getName(fieldID)];
        try {
            // localizedString
            let str = Trellis.getString("itemFields." + fieldObj.name);
            if (str == "itemFields." + fieldObj.name) {
                // Use name for localizedString
                str = fieldObj[0];
            }
            fieldObj.push(str);
        } catch(e) {
            fieldObj.push(/* name -> localizedString */fieldObj[0]);
        }
        fieldObj.push(/* isBaseField */ !baseMappedFields.includes(fieldID));
        schema.fields[fieldID] = fieldObj;
    }

    // names, localizedStrings, creatorTypes, and fields for each item type
    for (let type of types) {
        var fieldIDs = Trellis.ItemFields.getItemTypeFields(type.id);
        var baseFields = {};
        for (let fieldID of fieldIDs) {
            if (baseMappedFields.includes(fieldID)) {
                baseFields[fieldID] = Trellis.ItemFields.getBaseIDFromTypeAndField(type.id, fieldID);
            }
        }

        var icon = Trellis.ItemTypes.getImageSrc(type.name);
        icon = icon.substr(icon.lastIndexOf("/")+1);

        try {
            var creatorTypes = Trellis.CreatorTypes.getTypesForItemType(type.id).map((creatorType) => creatorType.id);
        } catch (e) {
            creatorTypes = [];
        }
        var primaryCreatorType = Trellis.CreatorTypes.getPrimaryIDForType(type.id);
        if(creatorTypes[0] != primaryCreatorType) {
            creatorTypes.splice(creatorTypes.indexOf(primaryCreatorType), 1);
            creatorTypes.unshift(primaryCreatorType);
        }

        schema.itemTypes[type.id] = [
                        /* name */type.name,
                        /* localizedString */Trellis.ItemTypes.getLocalizedString(type.name),
                        /* creatorTypes */creatorTypes,
                        /* fields */ fieldIDs,
                        /* baseFields */baseFields,
                        /* icon */icon
        ];

    }

    var types = Trellis.CreatorTypes.getTypes();
    for (let type of types) {
        schema.creatorTypes[type.id] = [
                        /* name */type.name,
                        /* localizedString */Trellis.CreatorTypes.getLocalizedString(type.name)
        ];
    }

    // Write to file
    var fp = new FilePicker();
    fp.init(window, Trellis.getString('dataDir.selectDir'), fp.modeGetFolder);
    
    let resultElem = document.getElementById('result');
    if (await fp.show() != fp.returnOK) {
        resultElem.innerHTML = '<p>Failed.</p>';
    } else {
        let schemaFile = Trellis.File.pathToFile(fp.file);
        schemaFile.append("trellisTypeSchemaData.js");
        await Trellis.File.putContentsAsync(
            schemaFile,
            `var TRELLIS_TYPE_SCHEMA = ${JSON.stringify(schema, null, '\t')};\n\n`
                 + "if (typeof module !== 'undefined') {\n\tmodule.exports = TRELLIS_TYPE_SCHEMA;\n}\n"
        );
        resultElem.innerHTML = `<p>Wrote ${schemaFile.path} successfully.</p>`;
    }
})();