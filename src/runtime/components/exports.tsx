import { React, hooks, FormattedMessage, getAppStore } from "jimu-core"
import { Select, TextArea, Form } from "./ui"
import { STYLES } from "../../shared/css"
import type {
  ExportFormProps,
  FieldConfig,
  ExportConfig,
  SelectOption,
} from "../../shared/types"
import { ExportType } from "../../shared/types"
import defaultMessages from "../../translations/default"
import { fmeActions } from "../../extensions/store"

const makeOptions = (translate: any, keys: string[]): SelectOption[] =>
  keys.map((key) => ({
    value: key,
    label: translate(key),
  }))

const createSelectOptions = (translate: any) => {
  return {
    coordinateSystems: makeOptions(translate, [
      "sweref99_1330",
      "sweref99_1500",
      "sweref99_1800",
      "wgs84",
    ]),
    coordinateSystemsWithNone: makeOptions(translate, [
      "utan_koordinater",
      "sweref99_1330",
    ]),
    formats: makeOptions(translate, ["geotiff", "jpeg", "png"]),
    cadFormats: makeOptions(translate, ["dwg", "dxf"]),
    allFormats: makeOptions(translate, [
      "dwg",
      "dxf",
      "geopackage",
      "esri_shape_directory",
    ]),
    dataPackages: {
      raster: makeOptions(translate, ["ortofoto", "flygfoto", "hojddata"]),
      model3d: makeOptions(translate, ["med_hojdmodell", "utan_hojdmodell"]),
      vector: makeOptions(translate, ["trackronor", "baskarta"]),
    },
  }
}

const createStrings = (translate: any, stringIds: string[]) => {
  return Object.fromEntries(stringIds.map((id) => [id, translate(id)]))
}

// Redux-based form management hook
const useReduxForm = <T extends { [key: string]: any }>(
  initialValues: T,
  exportType: string,
  requiredFields: Array<keyof T> = []
) => {
  const [values, setValues] = React.useState<{ [key: string]: any }>(
    initialValues
  )

  // Initialize form values only once
  hooks.useEffectOnce(() => {
    setValues(initialValues)
    getAppStore().dispatch(fmeActions.setFormValues(initialValues) as any)
  })

  const onChange = hooks.useEventCallback((field: keyof T, value: any) => {
    const newValues = { ...values, [field]: value }
    setValues(newValues)
    getAppStore().dispatch(fmeActions.setFormValues(newValues) as any)
  })

  const submitForm = hooks.useEventCallback(
    (onSubmit: (data: any) => void) => () => {
      onSubmit({ type: exportType, data: values })
    }
  )

  const isValid = requiredFields.every((field) => !!values[field as string])

  return { values, onChange, submitForm, isValid }
}

const config = (variant: ExportFormProps["variant"]): ExportConfig => {
  const configs: { [K in ExportFormProps["variant"]]: ExportConfig } = {
    [ExportType.AKTER]: {
      titleId: "akterTitle",
      subtitleId: "akterSubtitle",
      fields: [
        { field: "PARAMETER", labelId: "messageToAuthority", required: true },
      ],
      requiredFields: ["PARAMETER"], // PARAMETER is required for AKTER
    },
    [ExportType.PLANDOKUMENT]: {
      titleId: "plandokumentTitle",
      subtitleId: "plandokumentSubtitle",
      fields: [],
      instructions: "plandokumentInstructions1",
      requiredFields: [], // No required fields for PLANDOKUMENT
    },
    [ExportType.EXPORTERA_RASTER]: {
      titleId: "exportRasterTitle",
      subtitleId: "exportRasterSubtitle",
      fields: [
        {
          field: "COORD_SYS",
          labelId: "desiredCoordinateSystem",
          helperId: "coordinateSystemHelper",
          required: true,
          optionsKey: "coordinateSystems",
        },
        {
          field: "OUTPUT_FORMAT",
          labelId: "desiredFormat",
          required: true,
          optionsKey: "formats",
        },
        {
          field: "DATA_PACKAGE",
          labelId: "dataPackage",
          required: true,
          optionsKey: "dataPackages.raster",
        },
      ],
      requiredFields: ["COORD_SYS", "OUTPUT_FORMAT", "DATA_PACKAGE"],
    },
    [ExportType.EXPORT_3D_MODEL]: {
      titleId: "export3dModel",
      subtitleId: "export3dModelInstructions",
      fields: [
        {
          field: "DATA_PACKAGE",
          labelId: "dataPackage",
          required: true,
          optionsKey: "dataPackages.model3d",
        },
        {
          field: "COORD_SYS",
          labelId: "coordinateSystem",
          helperId: "sweref99_1330",
          readOnly: true,
          defaultValue: "sweref99_1330",
          optionsKey: "coordinateSystems",
        },
        {
          field: "OUTPUT_FORMAT",
          labelId: "format",
          helperId: "sketchup",
          readOnly: true,
          defaultValue: "sketchup",
          optionsKey: "formats",
        },
      ],
      requiredFields: ["DATA_PACKAGE"],
    },
    [ExportType.EXPORT_VECTOR_DATA]: {
      titleId: "exportVectorData",
      subtitleId: "exportVectorDataInstructions",
      fields: [
        {
          field: "DATA_PACKAGE",
          labelId: "dataPackage",
          required: true,
          optionsKey: "dataPackages.vector",
        },
        {
          field: "COORD_SYS",
          labelId: "coordinateSystem",
          required: true,
          optionsKey: "coordinateSystemsWithNone",
        },
        {
          field: "OUTPUT_FORMAT",
          labelId: "format",
          required: true,
          optionsKey: "cadFormats",
        },
        {
          field: "DESTINATION",
          labelId: "destination",
          helperId: "esri_shape_directory",
          readOnly: true,
          defaultValue: "esri_shape_directory",
        },
      ],
      requiredFields: ["DATA_PACKAGE", "COORD_SYS", "OUTPUT_FORMAT"],
    },
    [ExportType.EXPORT_OTHER]: {
      titleId: "exportOther",
      subtitleId: "exportOtherInstructions",
      fields: [
        {
          field: "COORD_SYS",
          labelId: "coordinateSystem",
          required: true,
          optionsKey: "coordinateSystems",
        },
        {
          field: "OUTPUT_FORMAT",
          labelId: "format",
          required: true,
          optionsKey: "allFormats",
        },
      ],
      requiredFields: ["COORD_SYS", "OUTPUT_FORMAT"],
    },
  }

  return configs[variant]
}

// Helper function to get options based on optionsKey
const fieldOptions = (
  optionsKey: string | undefined,
  allOptions: ReturnType<typeof createSelectOptions>
): SelectOption[] => {
  if (!optionsKey) return []

  const keyParts = optionsKey.split(".")
  if (keyParts.length === 1) {
    return allOptions[keyParts[0] as keyof typeof allOptions] as SelectOption[]
  } else if (keyParts.length === 2) {
    const [parent, child] = keyParts
    const parentObj = allOptions[parent as keyof typeof allOptions] as any
    return parentObj?.[child] || []
  }

  return []
}

export const Export: React.FC<ExportFormProps> = ({
  variant,
  onBack,
  onSubmit,
  isSubmitting = false,
}) => {
  const cfg = config(variant)
  const translate = hooks.useTranslation(defaultMessages)

  // Create options once with the translation function
  const options = createSelectOptions(translate)

  const initialValues = () => {
    const initial: { [key: string]: any } = {}
    cfg.fields.forEach((field) => {
      initial[field.field] = field.defaultValue || ""
    })
    return initial
  }

  const { values, onChange, submitForm, isValid } = useReduxForm(
    initialValues(),
    variant,
    [...(cfg.requiredFields || [])]
  )

  // Handle form submission state with Redux loading flags
  hooks.useUpdateEffect(() => {
    if (isSubmitting) {
      getAppStore().dispatch(
        fmeActions.setLoadingFlags({ isSubmittingOrder: true }) as any
      )
    } else {
      getAppStore().dispatch(
        fmeActions.setLoadingFlags({ isSubmittingOrder: false }) as any
      )
    }
  }, [isSubmitting])

  const handleSubmit = hooks.useEventCallback(() => {
    if (!isValid) {
      getAppStore().dispatch(
        fmeActions.setError({
          message: "Form validation failed. Please check required fields.",
          severity: "error" as any,
          type: "VALIDATION" as any,
          timestamp: new Date(),
        }) as any
      )
      return
    }

    submitForm(onSubmit)()
  })

  // String IDs computation
  const stringIds = [cfg.titleId, cfg.subtitleId]
  cfg.fields.forEach((field) => {
    stringIds.push(field.labelId)
    if (field.helperId) stringIds.push(field.helperId)
  })
  if (cfg.instructions) stringIds.push(cfg.instructions)
  if (variant === "akter") stringIds.push("messagePlaceholder")

  const texts = createStrings(translate, stringIds)

  // Event callbacks using jimu-core hooks for better performance
  const onFieldChange = hooks.useEventCallback(
    (field: string) => (value: string) => {
      onChange(field, value)
    }
  )

  const onTextChange = hooks.useEventCallback(
    (field: string) => (event: React.ChangeEvent<HTMLInputElement>) => {
      onChange(field, event.target.value)
    }
  )

  const renderField = (fieldConfig: FieldConfig) => {
    const {
      field,
      labelId,
      helperId,
      required = true,
      readOnly = false,
    } = fieldConfig

    if (field === "PARAMETER") {
      return (
        <Form
          variant="field"
          key={field}
          label={texts[labelId]}
          required={required}
        >
          <TextArea
            value={values[field] || ""}
            onChange={onTextChange(field)}
            placeholder={texts.messagePlaceholder}
            logging={{
              enabled: true,
              prefix: `FME-Export-${variant}`,
            }}
          />
        </Form>
      )
    }

    if (readOnly) {
      return (
        <Form
          variant="field"
          key={field}
          label={texts[labelId]}
          helper={helperId ? texts[helperId] : undefined}
          readOnly
        />
      )
    }

    const opts = fieldOptions(fieldConfig.optionsKey, options)
    return (
      <Form
        variant="field"
        key={field}
        label={texts[labelId]}
        helper={helperId ? texts[helperId] : undefined}
        required={required}
      >
        <Select
          options={opts}
          value={values[field] || ""}
          onChange={onFieldChange(field)}
          logging={{ enabled: true, prefix: `FME-Export-${variant}` }}
        />
      </Form>
    )
  }

  return (
    <Form
      variant="layout"
      title={texts[cfg.titleId]}
      subtitle={texts[cfg.subtitleId]}
      onBack={onBack}
      onSubmit={handleSubmit}
      isValid={isValid}
      loading={isSubmitting}
    >
      {cfg.instructions && (
        <div style={STYLES.typography.caption}>
          <FormattedMessage
            id={cfg.instructions}
            defaultMessage={defaultMessages[cfg.instructions]}
          />
        </div>
      )}
      {cfg.fields.map(renderField)}
    </Form>
  )
}

export default Export
